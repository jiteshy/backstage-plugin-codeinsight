import { User, CreateUserInput, PaginationOptions } from '../types';

import { BaseService } from './BaseService';

export class UserService extends BaseService {
  async getUsers(opts: PaginationOptions): Promise<User[]> {
    const offset = (opts.page - 1) * opts.limit;
    return this.db.query('SELECT * FROM users LIMIT $1 OFFSET $2', [opts.limit, offset]);
  }

  async getUserById(id: number): Promise<User | null> {
    const rows = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const rows = await this.db.query(
      'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING *',
      [input.email, input.name, input.role],
    );
    return rows[0];
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await this.db.query('DELETE FROM users WHERE id = $1', [id]);
    return result.length > 0;
  }
}
