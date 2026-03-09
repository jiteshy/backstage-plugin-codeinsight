import { InfoCard } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';

export const EntityCodeInsightContent = () => {
  const { entity } = useEntity();

  return (
    <InfoCard title="CodeInsight">
      <p>
        Code intelligence for <strong>{entity.metadata.name}</strong> — coming
        soon.
      </p>
      <p>Documentation, diagrams, and QnA will appear here once ingestion is configured.</p>
    </InfoCard>
  );
};
