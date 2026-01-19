import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { CENGLU_LOGGER, Logger } from 'cenglu';
import { UsersService } from './user.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './user.dto';

@Controller('users')
export class UsersController {
  private readonly logger: Logger;

  constructor(
    @Inject(CENGLU_LOGGER) logger: Logger,
    private readonly usersService: UsersService,
  ) {
    // Create child logger with controller context
    this.logger = logger.child({ controller: 'UsersController' });
  }

  @Get()
  async findAll(@Query() query: UserQueryDto) {
    this.logger.debug('Finding all users', { query });

    const users = await this.usersService.findAll(query);

    this.logger.info('Found users', { count: users.length });
    return users;
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    this.logger.debug('Finding user by ID', { userId: id });

    const user = await this.usersService.findOne(id);

    if (!user) {
      this.logger.warn('User not found', { userId: id });
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    this.logger.debug('Found user', { userId: id });
    return user;
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    this.logger.info('Creating user', { email: createUserDto.email });

    try {
      const user = await this.usersService.create(createUserDto);
      this.logger.info('User created', { userId: user.id });
      return user;
    } catch (error) {
      this.logger.error('Failed to create user', error as Error, {
        email: createUserDto.email,
      });
      throw error;
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    this.logger.info('Updating user', { userId: id });

    const user = await this.usersService.update(id, updateUserDto);

    if (!user) {
      this.logger.warn('User not found for update', { userId: id });
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    this.logger.info('User updated', { userId: id });
    return user;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    this.logger.info('Deleting user', { userId: id });

    const deleted = await this.usersService.remove(id);

    if (!deleted) {
      this.logger.warn('User not found for deletion', { userId: id });
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    this.logger.info('User deleted', { userId: id });
    return { success: true };
  }
}
