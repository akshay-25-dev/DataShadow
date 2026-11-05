import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8788;
// After `npm run build`, the same process serves the built client, so one deploy = one live link.
const app = createApp({ staticDir: path.resolve(here, '../../client/dist') });
app.listen(port, () => console.log(`DataShadow API listening on http://localhost:${port}`));
