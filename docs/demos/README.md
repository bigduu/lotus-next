# Project workspace recording

![Lotus Next creates a demo project in Bamboo, then selects it for the next task.](project-workspace.gif)

[Static final frame](project-workspace.png) · [Persisted project response](project-evidence.json) · [Isolation evidence](isolation-evidence.json) · [Recording script](record-project.cjs)

This is an actual Linux Chromium recording of Lotus Next source `1131c275cb441694a41f996228d9f91473d920f5`
connected to Bamboo source `025641317c5703226052a4b94a52d1844615c352`.
It creates a project with a real temporary directory through the normal UI, opens
the new-task view and selects that project. The script asserts the project name
and path in Bamboo's real API response. No API routes, outputs or model responses
are mocked. No task is submitted and no model runs; this demonstrates preparing
project context, not autonomous task completion or a released desktop build.

All data is disposable demonstration data. The final recording uses separate fresh Bamboo and Jiandu roots; both must be isolated, because Bamboo starts background memory maintenance. No existing configuration or session store is used in this replacement recording. The recording used Rust 1.95.0,
Node 24.19.0, Playwright Chromium and FFmpeg. Only Linux browser behavior was run.

## Reproduce

Build Bamboo from the revision above with its verified frontend staged. Start it
on loopback, using a newly created data directory:

```sh
DEMO_DATA=$(mktemp -d /tmp/lotus-readme-data-XXXXXX)
DEMO_MEMORY=$(mktemp -d /tmp/lotus-readme-memory-XXXXXX)
BAMBOO_JIANDU_DATA_DIR="$DEMO_MEMORY" \
  /absolute/path/to/source-built/bamboo serve \
  --bind 127.0.0.1 --port 9562 --data-dir "$DEMO_DATA" --workers 2
```

In another terminal, mark setup complete **only on that disposable demo server**:

```sh
curl -fsS -X POST http://127.0.0.1:9562/api/v1/bamboo/setup/complete
```

This intentionally bypasses provider setup for a provider-free project-management
recording. Normal users should run `bamboo init`; the setup marker does not make
model calls work. No real credentials are installed for this recording.

From Lotus Next, install locked dependencies and run `npm run dev -- --host 127.0.0.1`.
Then in another terminal, with the same Playwright browser installation available:

```sh
PLAYWRIGHT_MODULE=playwright node docs/demos/record-project.cjs
# Use the actual VIDEO path printed by that invocation:
ffmpeg -ss 1 -i "$VIDEO" \
  -filter_complex 'fps=8,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' \
  -loop 0 -y docs/demos/project-workspace.gif
```

The script requires an empty demo backend to avoid duplicate project paths. Set
`DEMO_WORKSPACE` to another temporary folder if needed. The browser context is new
and contains no daily browser profile. The script types and clicks real controls,
records video and captures a final PNG. Stop your demo services afterwards.

The GIF trims the initial second of startup and is palette-compressed: 1100×720,
124 frames, 15.51 seconds, 2,033,461 bytes, infinite loop. The final image and a
middle frame were visually reviewed for text and layout; every frame was decoded
successfully. No generated frames or simulated successful task output were added.

## Isolation QA and replacement

Independent QA found that `--data-dir` alone does not isolate Jiandu. The earlier
project recording was therefore withdrawn and replaced before Library upload.
The default Jiandu root was absent when checked; old startup logs lacked file
access detail, so no retrospective guarantee about that earlier run is made.
No private content was visible in the earlier demo frames. No default-store
contents were read for this investigation.

The replacement process was traced from startup through recording with
`strace -f -e trace=%file`. Its log reported an explicit Jiandu demo root. The
trace recorded 17 accesses under that root, including background Global-memory
checks and its write-lock creation; it recorded zero references to the default
Jiandu/Bamboo roots and zero `memory/v1` references outside the isolated root.
The sanitized evidence is linked above; full syscall logs remain local and are
not distributed. This validates this recorded interval, not a general sandbox
or all-platform isolation guarantee. No product code was changed.
