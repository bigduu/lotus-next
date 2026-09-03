#!/usr/bin/env python3
"""Deterministic OpenAI-compatible provider for the real-Bamboo E2E lane.

This server intentionally records only synthetic contract metadata. It never
persists credentials or request bodies. The server and Bamboo share a network
namespace, so the provider listens only on that namespace's loopback interface.
"""

from __future__ import annotations

import hmac
import http.client
import json
import os
import stat
import sys
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Iterator
from urllib.parse import urlsplit


MODEL = "gpt-4o-mini"
MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024
MAX_SMOKE_RESPONSE_BYTES = 1024 * 1024
SMOKE_SUCCESS_MESSAGE = "deterministic provider smoke passed"
SELF_TEST_SUCCESS_MESSAGE = "deterministic provider self-test passed"


def required_environment(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"required environment variable is missing: {name}")
    return value


def contains_marker(value: Any, marker: str) -> bool:
    if isinstance(value, str):
        return marker in value
    if isinstance(value, list):
        return any(contains_marker(entry, marker) for entry in value)
    if isinstance(value, dict):
        return any(contains_marker(entry, marker) for entry in value.values())
    return False


class ObservationStore:
    def __init__(self, path: Path, user_marker: str, assistant_marker: str) -> None:
        self._path = path
        self._user_marker = user_marker
        self._assistant_marker = assistant_marker
        self._requests: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def initialize(self) -> None:
        with self._lock:
            self._persist_locked()

    def append(
        self,
        *,
        method: str,
        request_path: str,
        model: str | None,
        stream: bool,
        user_marker_present: bool,
        smoke_marker_present: bool,
    ) -> None:
        with self._lock:
            self._requests.append(
                {
                    "sequence": len(self._requests) + 1,
                    "method": method,
                    "path": request_path,
                    "model": model,
                    "stream": stream,
                    "userMarkerPresent": user_marker_present,
                    "smokeMarkerPresent": smoke_marker_present,
                }
            )
            self._persist_locked()

    def _persist_locked(self) -> None:
        document = {
            "schemaVersion": 1,
            # These are random synthetic E2E identifiers, not user content.
            "userMarker": self._user_marker,
            "assistantMarker": self._assistant_marker,
            "requestCount": len(self._requests),
            "requests": self._requests,
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_name(
            f".{self._path.name}.tmp-{os.getpid()}-{threading.get_ident()}"
        )
        descriptor = -1
        try:
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                descriptor = -1
                json.dump(document, output, ensure_ascii=False, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self._path)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


class ProviderServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def handle_error(self, request: object, client_address: object) -> None:
        del request, client_address
        print("provider request handler failed", file=sys.stderr, flush=True)


class ProviderHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LotusRealBambooProvider/1"
    sys_version = ""

    api_key: str
    user_marker: str
    smoke_marker: str
    assistant_marker: str
    observations: ObservationStore

    def log_message(self, format: str, *args: object) -> None:
        # BaseHTTPRequestHandler logs the raw request target. Keep provider logs
        # free of caller-controlled data; observations contain the safe fields.
        del format, args

    def _send_json(self, status: int, value: object) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        actual = self.headers.get("Authorization", "")
        expected = f"Bearer {self.api_key}"
        return hmac.compare_digest(actual, expected)

    def _require_authorization(self) -> bool:
        if self._authorized():
            return True
        self._send_json(401, {"error": {"message": "invalid test credential"}})
        return False

    def do_GET(self) -> None:
        if not self._require_authorization():
            return
        request_path = urlsplit(self.path).path
        if request_path != "/v1/models":
            self._send_json(
                404, {"error": {"message": "unsupported test provider path"}}
            )
            return
        self._send_json(
            200,
            {
                "object": "list",
                "data": [
                    {
                        "id": MODEL,
                        "object": "model",
                        "created": 0,
                        "owned_by": "lotus-real-bamboo-e2e",
                    }
                ],
            },
        )

    def do_POST(self) -> None:
        if not self._require_authorization():
            return
        request_path = urlsplit(self.path).path
        if request_path != "/v1/chat/completions":
            self._send_json(
                404, {"error": {"message": "unsupported test provider path"}}
            )
            return

        try:
            content_length = int(self.headers.get("Content-Length", ""))
            if content_length < 0 or content_length > MAX_REQUEST_BODY_BYTES:
                raise ValueError("request size is outside the harness limit")
            body = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError):
            self._send_json(
                400, {"error": {"message": "invalid test provider request"}}
            )
            return

        model = body.get("model") if isinstance(body, dict) else None
        model = model if isinstance(model, str) else None
        stream = isinstance(body, dict) and body.get("stream") is True
        user_marker_present = contains_marker(body, self.user_marker)
        smoke_marker_present = contains_marker(body, self.smoke_marker)
        self.observations.append(
            method="POST",
            request_path=request_path,
            # Persist only the harness-owned model literal. An authenticated
            # negative request must never turn a caller-controlled model value
            # into preserved evidence.
            model=MODEL if model == MODEL else None,
            stream=stream,
            user_marker_present=user_marker_present,
            smoke_marker_present=smoke_marker_present,
        )

        if (
            model != MODEL
            or not stream
            or not (user_marker_present or smoke_marker_present)
        ):
            self._send_json(
                422,
                {
                    "error": {
                        "message": (
                            "request did not satisfy the real-Bamboo E2E contract"
                        )
                    }
                },
            )
            return

        chunk_base = {
            "id": "chatcmpl-lotus-real-bamboo-e2e",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": MODEL,
        }
        frames = [
            {
                **chunk_base,
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "role": "assistant",
                            "content": self.assistant_marker,
                        },
                        "finish_reason": None,
                    }
                ],
            },
            {
                **chunk_base,
                "choices": [
                    {"index": 0, "delta": {}, "finish_reason": "stop"}
                ],
                "usage": None,
            },
            {
                **chunk_base,
                "choices": [],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                    "prompt_tokens_details": {"cached_tokens": 0},
                    "completion_tokens_details": {"reasoning_tokens": 0},
                },
            },
        ]

        self.send_response(200)
        self.send_header("Cache-Control", "no-cache, no-store")
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "close")
        self.end_headers()
        for frame in frames:
            encoded = json.dumps(frame, separators=(",", ":"))
            self.wfile.write(f"data: {encoded}\n\n".encode("utf-8"))
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True


def provider_port() -> int:
    try:
        port = int(required_environment("LOTUS_REAL_PROVIDER_PORT"))
    except ValueError as error:
        raise RuntimeError(
            "LOTUS_REAL_PROVIDER_PORT is not a valid TCP port"
        ) from error
    if port < 1 or port > 65535:
        raise RuntimeError("LOTUS_REAL_PROVIDER_PORT is outside the TCP port range")
    return port


def request_completion(
    *,
    api_key: str,
    port: int,
    request_document: dict[str, Any],
) -> tuple[int, str, bytes]:
    request_body = json.dumps(
        request_document,
        separators=(",", ":"),
    ).encode("utf-8")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request(
            "POST",
            "/v1/chat/completions",
            body=request_body,
            headers={
                "Accept": "text/event-stream",
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        response = connection.getresponse()
        status = response.status
        content_type = response.getheader("Content-Type", "")
        response_body = response.read(MAX_SMOKE_RESPONSE_BYTES + 1)
    finally:
        connection.close()

    if len(response_body) > MAX_SMOKE_RESPONSE_BYTES:
        raise RuntimeError("provider smoke response exceeded the size limit")
    return status, content_type, response_body


def request_models(
    *,
    port: int,
    authorization: str | None,
) -> tuple[int, str, bytes]:
    headers = {"Authorization": authorization} if authorization is not None else {}
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request("GET", "/v1/models", headers=headers)
        response = connection.getresponse()
        status = response.status
        content_type = response.getheader("Content-Type", "")
        response_body = response.read(MAX_SMOKE_RESPONSE_BYTES + 1)
    finally:
        connection.close()

    if len(response_body) > MAX_SMOKE_RESPONSE_BYTES:
        raise RuntimeError("provider models response exceeded the size limit")
    return status, content_type, response_body


def validate_models_endpoint(*, port: int, api_key: str) -> None:
    unauthorized_document = {"error": {"message": "invalid test credential"}}
    attempts = [
        (None, 401, unauthorized_document),
        ("Bearer self-test-wrong-credential", 401, unauthorized_document),
        (
            f"Bearer {api_key}",
            200,
            {
                "object": "list",
                "data": [
                    {
                        "id": MODEL,
                        "object": "model",
                        "created": 0,
                        "owned_by": "lotus-real-bamboo-e2e",
                    }
                ],
            },
        ),
    ]
    for authorization, expected_status, expected_document in attempts:
        status, content_type, response_body = request_models(
            port=port,
            authorization=authorization,
        )
        if status != expected_status:
            raise RuntimeError("provider models endpoint returned an unexpected status")
        if content_type.split(";", maxsplit=1)[0].strip().lower() != (
            "application/json"
        ):
            raise RuntimeError("provider models endpoint was not a JSON response")
        try:
            document = json.loads(response_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError(
                "provider models endpoint returned invalid JSON"
            ) from error
        if document != expected_document:
            raise RuntimeError("provider models endpoint changed unexpectedly")


def validate_smoke() -> None:
    api_key = required_environment("LOTUS_REAL_PROVIDER_API_KEY")
    user_marker = required_environment("LOTUS_REAL_PROVIDER_USER_MARKER")
    smoke_marker = required_environment("LOTUS_REAL_PROVIDER_SMOKE_MARKER")
    assistant_marker = required_environment("LOTUS_REAL_PROVIDER_ASSISTANT_MARKER")
    observations_path = Path(
        required_environment("LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH")
    )
    port = provider_port()

    status, content_type, response_body = request_completion(
        api_key=api_key,
        port=port,
        request_document={
            "model": MODEL,
            "stream": True,
            "messages": [{"role": "user", "content": smoke_marker}],
        },
    )
    if status != 200:
        raise RuntimeError("provider smoke request did not return HTTP 200")
    if content_type.split(";", maxsplit=1)[0].strip().lower() != (
        "text/event-stream"
    ):
        raise RuntimeError("provider smoke response was not an SSE stream")
    try:
        response_text = response_body.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError("provider smoke response was not valid UTF-8") from error

    data_values: list[str] = []
    for line in response_text.splitlines():
        if not line:
            continue
        if not line.startswith("data:"):
            raise RuntimeError("provider smoke response contained a non-data SSE line")
        data_values.append(line.removeprefix("data:").lstrip(" "))

    if not data_values or data_values[-1] != "[DONE]":
        raise RuntimeError("provider smoke response did not terminate with [DONE]")
    if "[DONE]" in data_values[:-1]:
        raise RuntimeError("provider smoke response continued after [DONE]")

    assistant_marker_present = False
    json_frame_count = 0
    for data_value in data_values[:-1]:
        try:
            frame = json.loads(data_value)
        except json.JSONDecodeError as error:
            raise RuntimeError(
                "provider smoke response contained invalid JSON"
            ) from error
        json_frame_count += 1
        assistant_marker_present = assistant_marker_present or contains_marker(
            frame, assistant_marker
        )

    if json_frame_count == 0:
        raise RuntimeError("provider smoke response did not contain a JSON frame")
    if not assistant_marker_present:
        raise RuntimeError("provider smoke response omitted the assistant marker")

    # Exercise the rejection path with a synthetic canary in a caller-controlled
    # model field. The server must return 422 while preserving only model=null;
    # neither this canary, the credential, nor the smoke marker may reach disk.
    sensitive_model_canary = f"caller-controlled-sensitive-model-{os.getpid()}"
    rejected_status, rejected_content_type, rejected_body = request_completion(
        api_key=api_key,
        port=port,
        request_document={
            "model": sensitive_model_canary,
            "stream": True,
            "messages": [{"role": "user", "content": smoke_marker}],
        },
    )
    if rejected_status != 422:
        raise RuntimeError("provider rejection smoke did not return HTTP 422")
    if rejected_content_type.split(";", maxsplit=1)[0].strip().lower() != (
        "application/json"
    ):
        raise RuntimeError("provider rejection smoke was not a JSON response")
    try:
        rejected_document = json.loads(rejected_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("provider rejection smoke response was invalid") from error
    if rejected_document != {
        "error": {
            "message": "request did not satisfy the real-Bamboo E2E contract"
        }
    }:
        raise RuntimeError("provider rejection smoke response changed unexpectedly")

    observations_text = observations_path.read_text(encoding="utf-8")
    if any(
        secret in observations_text
        for secret in (sensitive_model_canary, api_key, smoke_marker)
    ):
        raise RuntimeError("provider observations persisted sensitive request data")
    try:
        observations = json.loads(observations_text)
    except json.JSONDecodeError as error:
        raise RuntimeError("provider observations were not valid JSON") from error
    expected_observations = {
        "schemaVersion": 1,
        "userMarker": user_marker,
        "assistantMarker": assistant_marker,
        "requestCount": 2,
        "requests": [
            {
                "sequence": 1,
                "method": "POST",
                "path": "/v1/chat/completions",
                "model": MODEL,
                "stream": True,
                "userMarkerPresent": False,
                "smokeMarkerPresent": True,
            },
            {
                "sequence": 2,
                "method": "POST",
                "path": "/v1/chat/completions",
                "model": None,
                "stream": True,
                "userMarkerPresent": False,
                "smokeMarkerPresent": True,
            },
        ],
    }
    if observations != expected_observations:
        raise RuntimeError("provider smoke observations were not safely redacted")
    if stat.S_IMODE(observations_path.stat().st_mode) != 0o600:
        raise RuntimeError("provider observations did not retain mode 0600")


def run_smoke() -> None:
    validate_smoke()
    print(SMOKE_SUCCESS_MESSAGE, flush=True)


def create_provider_server(bind_port: int) -> ProviderServer:
    if bind_port < 0 or bind_port > 65535:
        raise RuntimeError("provider bind port is outside the TCP port range")
    api_key = required_environment("LOTUS_REAL_PROVIDER_API_KEY")
    user_marker = required_environment("LOTUS_REAL_PROVIDER_USER_MARKER")
    smoke_marker = required_environment("LOTUS_REAL_PROVIDER_SMOKE_MARKER")
    assistant_marker = required_environment("LOTUS_REAL_PROVIDER_ASSISTANT_MARKER")
    observations_path = Path(
        required_environment("LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH")
    )

    store = ObservationStore(observations_path, user_marker, assistant_marker)
    ProviderHandler.api_key = api_key
    ProviderHandler.user_marker = user_marker
    ProviderHandler.smoke_marker = smoke_marker
    ProviderHandler.assistant_marker = assistant_marker
    ProviderHandler.observations = store

    server = ProviderServer(("127.0.0.1", bind_port), ProviderHandler)
    try:
        # Bind first, then publish the initial file. Once the host observes the
        # schemaVersion=1/requestCount=0 document, the loopback endpoint is bound.
        store.initialize()
    except BaseException:
        server.server_close()
        raise
    return server


def serve() -> None:
    server = create_provider_server(provider_port())
    print("deterministic provider ready", flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


@contextmanager
def temporary_environment(values: dict[str, str]) -> Iterator[None]:
    previous = {name: os.environ[name] for name in values if name in os.environ}
    previously_absent = set(values).difference(previous)
    os.environ.update(values)
    try:
        yield
    finally:
        for name in previously_absent:
            os.environ.pop(name, None)
        for name, value in previous.items():
            os.environ[name] = value


def run_self_test() -> None:
    self_test_id = str(os.getpid())
    with TemporaryDirectory(prefix="lotus-real-provider-self-test-") as directory:
        observations_path = Path(directory) / "observations.json"
        environment = {
            "LOTUS_REAL_PROVIDER_API_KEY": f"self-test-api-key-{self_test_id}",
            "LOTUS_REAL_PROVIDER_USER_MARKER": f"SELF_TEST_USER_{self_test_id}",
            "LOTUS_REAL_PROVIDER_SMOKE_MARKER": f"SELF_TEST_SMOKE_{self_test_id}",
            "LOTUS_REAL_PROVIDER_ASSISTANT_MARKER": (
                f"SELF_TEST_ASSISTANT_{self_test_id}"
            ),
            "LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH": str(observations_path),
            # create_provider_server(0) obtains an ephemeral port. This value is
            # replaced with the bound port before the shared smoke validator runs.
            "LOTUS_REAL_PROVIDER_PORT": "0",
        }
        environment_before = {
            name: (name in os.environ, os.environ.get(name)) for name in environment
        }
        with temporary_environment(environment):
            server = create_provider_server(0)
            server_thread = threading.Thread(
                target=server.serve_forever,
                kwargs={"poll_interval": 0.05},
                name="lotus-real-provider-self-test",
            )
            thread_started = False
            try:
                os.environ["LOTUS_REAL_PROVIDER_PORT"] = str(server.server_port)
                server_thread.start()
                thread_started = True
                validate_models_endpoint(
                    port=server.server_port,
                    api_key=environment["LOTUS_REAL_PROVIDER_API_KEY"],
                )
                validate_smoke()
            finally:
                if thread_started and server_thread.is_alive():
                    server.shutdown()
                server.server_close()
                if thread_started:
                    server_thread.join(timeout=5)
                    if server_thread.is_alive():
                        raise RuntimeError("provider self-test server did not stop")

        for name, (was_present, previous_value) in environment_before.items():
            if was_present:
                if os.environ.get(name) != previous_value:
                    raise RuntimeError(
                        "provider self-test did not restore its environment"
                    )
            elif name in os.environ:
                raise RuntimeError("provider self-test leaked an environment variable")

    print(SELF_TEST_SUCCESS_MESSAGE, flush=True)


def main() -> None:
    arguments = sys.argv[1:]
    if arguments == ["--smoke"]:
        run_smoke()
        return
    if arguments == ["--self-test"]:
        run_self_test()
        return
    if arguments:
        raise RuntimeError("unsupported provider command-line argument")
    serve()


if __name__ == "__main__":
    main()
