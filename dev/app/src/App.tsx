import { createApp } from '@backstage/app-defaults';
import { AppRouter, FlatRoutes } from '@backstage/core-app-api';
import {
  CatalogEntityPage,
  CatalogIndexPage,
  EntityLayout,
} from '@backstage/plugin-catalog';
import { EntityCodeInsightContent } from '@codeinsight/plugin';
import { Route } from 'react-router-dom';

const entityPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title="Overview">
      <div style={{ padding: 24 }}>Entity Overview — placeholder for dev</div>
    </EntityLayout.Route>
    <EntityLayout.Route path="/codeinsight" title="CodeInsight">
      <EntityCodeInsightContent />
    </EntityLayout.Route>
  </EntityLayout>
);

const app = createApp();

export default app.createRoot(
  <AppRouter>
    <FlatRoutes>
      <Route path="/catalog" element={<CatalogIndexPage />} />
      <Route
        path="/catalog/:namespace/:kind/:name"
        element={<CatalogEntityPage />}
      >
        {entityPage}
      </Route>
    </FlatRoutes>
  </AppRouter>,
);
