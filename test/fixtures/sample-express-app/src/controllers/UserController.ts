import { Request, Response } from 'express';

import { UserService } from '../services/UserService';
import { CreateUserInput } from '../types';

export class UserController {
  constructor(private readonly userService: UserService) {}

  async list(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const users = await this.userService.getUsers({ page, limit });
    res.json(users);
  }

  async getById(req: Request, res: Response): Promise<void> {
    const user = await this.userService.getUserById(parseInt(req.params.id));
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  }

  async create(req: Request, res: Response): Promise<void> {
    const input: CreateUserInput = req.body;
    const user = await this.userService.createUser(input);
    res.status(201).json(user);
  }

  async delete(req: Request, res: Response): Promise<void> {
    const deleted = await this.userService.deleteUser(parseInt(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.status(204).send();
  }
}
