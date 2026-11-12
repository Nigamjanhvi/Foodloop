import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Workspace scripts run with backend/ as their working directory, while the
// project environment file lives at the monorepo root. Resolve it from this
// module so CLI commands and the API server load the same configuration.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') });
