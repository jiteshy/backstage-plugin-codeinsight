import { createApp } from '@backstage/app-defaults';
import { AppRouter, FlatRoutes } from '@backstage/core-app-api';
import { AlertDisplay } from '@backstage/core-components';
import {
  CatalogEntityPage,
  CatalogIndexPage,
  EntityLayout,
} from '@backstage/plugin-catalog';
import { themes, UnifiedThemeProvider } from '@backstage/theme';
import { EntityCodeInsightContent } from '@codeinsight/plugin';
import React from 'react';
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

const app = createApp({
  themes: [
    {
      id: 'light',
      title: 'Light',
      variant: 'light',
      Provider: ({ children }: { children: React.ReactNode }) => (
        <UnifiedThemeProvider theme={themes.light}>{children}</UnifiedThemeProvider>
      ),
    },
    {
      id: 'dark',
      title: 'Dark',
      variant: 'dark',
      Provider: ({ children }: { children: React.ReactNode }) => (
        <UnifiedThemeProvider theme={themes.dark}>{children}</UnifiedThemeProvider>
      ),
    },
  ],
});

export default app.createRoot(
  <AppRouter>
    <AlertDisplay />
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
