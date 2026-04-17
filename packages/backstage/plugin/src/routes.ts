import { createRouteRef } from '@backstage/core-plugin-api';

export const rootRouteRef = createRouteRef({
  id: 'codeinsight',
});

export const usageRouteRef = createRouteRef({
  id: 'codeinsight.usage',
});
