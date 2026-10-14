# Supervisor entry evidence

Generated from the built production artifact by `npx playwright test e2e/supervisor-sidebar.spec.ts --workers=1`. The suite passed all 18 cases across desktop, tablet, and phone. API responses are deterministic browser fixtures; these images do not claim installed Bodhi or real Bamboo acceptance.

- `desktop.png` and `phone.png`: saved custom title with the role description and rename action.
- `rename-dialog.png`: localized name editor. The suite also verifies blank-name rejection, Escape cancellation, save failure with retry, focus restoration after closing, saved-name reload, and the upstream explicit-open/navigation behavior.
