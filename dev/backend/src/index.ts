import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// Core Backstage plugins for dev
backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'));

// CodeInsight plugin
backend.add(import('@codeinsight/plugin-backend'));

backend.start();
