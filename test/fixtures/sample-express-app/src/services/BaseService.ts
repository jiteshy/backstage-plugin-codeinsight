export interface Database {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
}

export abstract class BaseService {
  constructor(protected readonly db: Database) {}
}
