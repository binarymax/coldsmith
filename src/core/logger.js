/**
 * Logging.
 *
 * This replaces winston, which was three orders of magnitude more machinery
 * than a static site generator needs: one transport, five levels, stdout and
 * stderr.
 *
 * The exported shape is unchanged, because the CLI reaches into it directly to
 * apply --verbose and --quiet:
 *
 *     logger.transports[0].level = 'verbose'
 *     logger.transports[0].quiet = true
 */

import util from 'node:util'

import chalk from 'chalk'

// npm level ordering, kept so that a transport at 'info' still means
// "error, warn and info, but not verbose or silly".
const LEVELS = { error: 0, warn: 1, info: 2, verbose: 4, silly: 6 }

export class ConsoleTransport {
  constructor({ level = 'info', quiet = false } = {}) {
    this.name = 'cli'
    this.level = level
    this.quiet = quiet
  }

  enabled(level) {
    return LEVELS[level] <= LEVELS[this.level]
  }

  log(level, message, meta) {
    if (!this.enabled(level)) return

    if (level === 'error') {
      process.stderr.write(`\n  ${chalk.red('error')} ${message}\n`)
      const detailed = this.level === 'verbose' || this.level === 'silly'
      if (detailed && meta != null) {
        if (meta.stack != null) {
          // Drop the first line - it repeats the message just printed.
          process.stderr.write(
            meta.stack.substr(meta.stack.indexOf('\n') + 1) + '\n\n',
          )
        }
        for (const key of Object.keys(meta)) {
          if (key === 'message' || key === 'stack') continue
          const value = util
            .inspect(meta[key], false, 2, true)
            .replace(/\n/g, '\n    ')
          process.stderr.write(`    ${key}: ${value}\n`)
        }
      } else {
        process.stderr.write('\n')
      }
      return
    }

    if (this.quiet) return

    let line = message
    if (level !== 'info') {
      const color = level === 'warn' ? 'yellow' : 'grey'
      line = `${chalk[color](level)} ${line}`
    }
    if (meta != null && Object.keys(meta).length > 0) {
      line += util.format(' %j', meta)
    }
    process.stdout.write(`  ${line}\n`)
  }
}

export const transports = [new ConsoleTransport({ level: 'info' })]

function emit(level, message, meta) {
  for (const transport of transports) {
    transport.log(level, message, meta)
  }
}

export const logger = {
  transports,
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  verbose: (message, meta) => emit('verbose', message, meta),
  silly: (message, meta) => emit('silly', message, meta),
}
