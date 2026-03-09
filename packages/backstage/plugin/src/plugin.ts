import {
  createApiFactory,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';

import { codeInsightApiRef } from './api';
import { CodeInsightClient } from './api-client';
import { rootRouteRef } from './routes';

export const codeinsightPlugin = createPlugin({
  id: 'codeinsight',
  routes: {
    root: rootRouteRef,
  },
  apis: [
    createApiFactory({
      api: codeInsightApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        fetchApi: fetchApiRef,
      },
      factory: ({ discoveryApi, fetchApi }) =>
        new CodeInsightClient({ discoveryApi, fetchApi }),
    }),
  ],
});

export const EntityCodeInsightContent = codeinsightPlugin.provide(
  createRoutableExtension({
    name: 'EntityCodeInsightContent',
    component: () =>
      import('./components/EntityCodeInsightContent').then(
        m => m.EntityCodeInsightContent,
      ),
    mountPoint: rootRouteRef,
  }),
);
