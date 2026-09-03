#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('dbq')
  .description('Executor read-only de queries SQL e MongoDB')
  .version('0.1.0');

program.parse();
