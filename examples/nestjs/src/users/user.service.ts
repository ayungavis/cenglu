// biome-ignore-all lint: it's an example code
import { Inject, Injectable } from "@nestjs/common";
import { CENGLU_LOGGER, type Logger } from "cenglu";
import type { CreateUserDto, UpdateUserDto, UserQueryDto } from "./user.dto";

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UsersService {
  private readonly logger: Logger;
  private users: Map<string, User> = new Map();

  constructor(@Inject(CENGLU_LOGGER) logger: Logger) {
    this.logger = logger.child({ service: "UsersService" });

    // Add some sample data
    this.seedData();
  }

  private seedData(): void {
    const sampleUsers: User[] = [
      {
        id: "1",
        email: "alice@example.com",
        name: "Alice Johnson",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "2",
        email: "bob@example.com",
        name: "Bob Smith",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    sampleUsers.forEach((user) => this.users.set(user.id, user));
    this.logger.debug("Seeded sample users", { count: sampleUsers.length });
  }

  async findAll(query: UserQueryDto): Promise<User[]> {
    this.logger.debug("Querying users", { query });

    let users = Array.from(this.users.values());

    if (query.search) {
      const search = query.search.toLowerCase();
      users = users.filter(
        (u) => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search)
      );
    }

    // Pagination
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;
    users = users.slice(offset, offset + limit);

    return await Promise.resolve(users);
  }

  async findOne(id: string): Promise<User | null> {
    this.logger.debug("Finding user by ID", { userId: id });
    return await Promise.resolve(this.users.get(id) ?? null);
  }

  async create(dto: CreateUserDto): Promise<User> {
    this.logger.debug("Creating user", { email: dto.email });

    // Check for duplicate email
    const existing = Array.from(this.users.values()).find((u) => u.email === dto.email);

    if (existing) {
      this.logger.warn("Duplicate email", { email: dto.email });
      throw new Error("Email already exists");
    }

    const user: User = {
      id: String(Date.now()),
      email: dto.email,
      name: dto.name,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(user.id, user);
    this.logger.info("User created in database", { userId: user.id });

    return await Promise.resolve(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User | null> {
    this.logger.debug("Updating user", { userId: id });

    const user = this.users.get(id);
    if (!user) {
      return null;
    }

    const updated: User = {
      ...user,
      ...(dto as Partial<User>),
      updatedAt: new Date(),
    };

    this.users.set(id, updated);
    this.logger.info("User updated in database", { userId: id });

    return await Promise.resolve(updated);
  }

  async remove(id: string): Promise<boolean> {
    this.logger.debug("Removing user", { userId: id });

    if (!this.users.has(id)) {
      return false;
    }

    this.users.delete(id);
    this.logger.info("User removed from database", { userId: id });

    return await Promise.resolve(true);
  }
}
