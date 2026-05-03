/**
 * Custom ESLint rule: no-silent-promise-catch
 *
 * Flags Promise.prototype.catch handlers that silently swallow errors.
 * Step 9 of the bulkhead/observability plan: silent async-error swallow is
 * one of the failure modes the bulkhead pass is meant to eliminate.
 *
 * Catches the common shapes:
 *   - .catch(() => {})                         empty arrow body
 *   - .catch((err) => { doSomethingSilent })   arrow with no log.error/warn/fatal call
 *   - .catch(console.error)                    bare console reference
 *   - .catch(console.warn)
 *
 * Allows:
 *   - .catch(() => { log.error(...) })
 *   - .catch(() => { throw err })
 *   - .catch(myNamedHandler)                   we can't see the handler body
 *
 * Severity: 'warn' (not 'error') — there will be hits in legacy code; we
 * don't want to break CI on Day 1.
 *
 * Heuristic, not a proof. False negatives (named handler that swallows)
 * are accepted; the goal is to catch the *common* swallow shapes.
 */
'use strict'

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Promise.catch handler must call log.error/warn/fatal or rethrow.',
    },
    schema: [],
    messages: {
      silentCatch:
        'Promise.catch handler must call log.error/warn/fatal or rethrow. ' +
        'Silent swallow defeats the bulkhead/observability layer.',
    },
  },
  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      "CallExpression[callee.type='MemberExpression'][callee.property.name='catch']"(
        node,
      ) {
        const handler = node.arguments[0]
        if (!handler) return

        // Inline function (arrow or function expression)
        if (
          handler.type === 'ArrowFunctionExpression' ||
          handler.type === 'FunctionExpression'
        ) {
          const body = handler.body
          const src = sourceCode.getText(body)
          const hasLog = /\blog\.(error|warn|fatal)\b/.test(src)
          const hasThrow = /\bthrow\b/.test(src)
          if (!hasLog && !hasThrow) {
            context.report({ node, messageId: 'silentCatch' })
          }
          return
        }

        // Bare console.* reference: .catch(console.error), .catch(console.warn)
        if (
          handler.type === 'MemberExpression' &&
          handler.object &&
          handler.object.type === 'Identifier' &&
          handler.object.name === 'console'
        ) {
          context.report({ node, messageId: 'silentCatch' })
          return
        }

        // Bare identifier named "console" (rare but matches the original spec).
        if (handler.type === 'Identifier' && handler.name === 'console') {
          context.report({ node, messageId: 'silentCatch' })
          return
        }

        // Any other handler shape (named function, method ref, etc.) is left
        // alone — we can't reason about its body from a single AST node.
      },
    }
  },
}
