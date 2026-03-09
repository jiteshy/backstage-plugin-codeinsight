import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';

import { createRouter } from './router';

export const codeinsightPlugin = createBackendPlugin({
  pluginId: 'codeinsight',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
      },
      async init({ config, logger, database, httpRouter }) {
        logger.info('Initializing CodeInsight backend plugin');

        const router = await createRouter({ config, logger, database });
        httpRouter.use(router);

        // Health endpoint does not require auth
        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        logger.info('CodeInsight backend plugin initialized');
      },
    });
  },
});
