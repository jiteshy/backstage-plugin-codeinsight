import { Post, CreatePostInput, PaginationOptions } from '../types';

import { BaseService } from './BaseService';

export class PostService extends BaseService {
  async getPosts(opts: PaginationOptions): Promise<Post[]> {
    const offset = (opts.page - 1) * opts.limit;
    return this.db.query('SELECT * FROM posts LIMIT $1 OFFSET $2', [opts.limit, offset]);
  }

  async getPostById(id: number): Promise<Post | null> {
    const rows = await this.db.query('SELECT * FROM posts WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async getPostsByAuthor(authorId: number): Promise<Post[]> {
    return this.db.query('SELECT * FROM posts WHERE author_id = $1', [authorId]);
  }

  async createPost(input: CreatePostInput): Promise<Post> {
    const rows = await this.db.query(
      'INSERT INTO posts (title, content, author_id, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [input.title, input.content, input.authorId, input.status],
    );
    return rows[0];
  }

  async publishPost(id: number): Promise<Post | null> {
    const rows = await this.db.query(
      "UPDATE posts SET status = 'PUBLISHED' WHERE id = $1 RETURNING *",
      [id],
    );
    return rows[0] ?? null;
  }
}
