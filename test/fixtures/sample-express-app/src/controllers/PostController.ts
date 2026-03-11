import { Request, Response } from 'express';

import { PostService } from '../services/PostService';
import { CreatePostInput } from '../types';

export class PostController {
  constructor(private readonly postService: PostService) {}

  async list(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const posts = await this.postService.getPosts({ page, limit });
    res.json(posts);
  }

  async getById(req: Request, res: Response): Promise<void> {
    const post = await this.postService.getPostById(parseInt(req.params.id));
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    res.json(post);
  }

  async create(req: Request, res: Response): Promise<void> {
    const input: CreatePostInput = req.body;
    const post = await this.postService.createPost(input);
    res.status(201).json(post);
  }

  async publish(req: Request, res: Response): Promise<void> {
    const post = await this.postService.publishPost(parseInt(req.params.id));
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    res.json(post);
  }
}
