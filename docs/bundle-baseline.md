# Production bundle baseline

This baseline was reproduced from `origin/main` at commit `e3b6911d92316410caddfd8da113afba3da039eb` on 2026-09-01 with Node.js 22.22.3 and npm 10.9.8:

```bash
npm ci
npm run build
```

Vite 8.1.0 transformed 2,639 modules and reported the following generated assets:

| Asset group | Raw size | Gzip size |
| --- | ---: | ---: |
| `dist/index.html` | 1.34 kB | 0.60 kB |
| application CSS | 90.38 kB | 14.91 kB |
| application entry | 659.57 kB | 176.19 kB |
| syntax-highlighter vendor chunk | 665.89 kB | 232.13 kB |
| general vendor chunk | 4,473.38 kB | 1,249.32 kB |

Vite also emitted its existing warning that some chunks exceed 500 kB after minification. This document records that known starting point; issue #12 does not change the existing `manualChunks` strategy or introduce a bundle budget. Future optimization should compare equivalent production builds against this baseline.
