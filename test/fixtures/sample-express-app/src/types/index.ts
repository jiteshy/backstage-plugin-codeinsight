export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
}

export interface Post {
  id: number;
  title: string;
  content: string;
  authorId: number;
  status: PostStatus;
  createdAt: Date;
}

export enum Role {
  ADMIN = 'ADMIN',
  USER = 'USER',
  MODERATOR = 'MODERATOR',
}

export enum PostStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export type CreateUserInput = Omit<User, 'id' | 'createdAt'>;
export type CreatePostInput = Omit<Post, 'id' | 'createdAt'>;
