import http from 'node:http'
import next from 'next'
import config from '../next.config.ts'

const port = 3034
const app = next({ dev: true, hostname: '127.0.0.1', port, conf: {
  ...config, distDir: 'tmp/renoapp-brand-next',
  typescript: { tsconfigPath: 'tmp/renoapp-brand-tsconfig.json' },
} })
await app.prepare()
http.createServer(app.getRequestHandler()).listen(port, '127.0.0.1', () => {
  console.log(`RenoApp brand preview: http://127.0.0.1:${port}`)
})
