const SQL_KEYWORDS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'FROM',
  'WHERE',
  'SET',
  'JOIN',
  'LIMIT',
  'VALUES',
  'INTO',
  'TABLE',
];

// eslint-disable-next-line security/detect-non-literal-regexp -- constant keyword list
const SQL_KEYWORD_REGEX = new RegExp(
  `\\b(?:${SQL_KEYWORDS.join('|')})\\b`,
  'i',
);

function containsSqlKeyword(str) {
  return typeof str === 'string' && SQL_KEYWORD_REGEX.test(str);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow building SQL with string concatenation or template literals',
      category: 'Security',
      recommended: true,
    },
    schema: [],
    messages: {
      noSqlBuilding:
        'Build SQL as an AST and deparse it, or use bound parameters.',
    },
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        if (!node.expressions || node.expressions.length === 0) {
          return;
        }

        const hasKeyword = node.quasis.some((quasi) =>
          containsSqlKeyword(quasi.value.raw || quasi.value.cooked),
        );

        if (hasKeyword) {
          context.report({
            node,
            messageId: 'noSqlBuilding',
          });
        }
      },

      BinaryExpression(node) {
        if (node.operator !== '+') return;

        // Only handle the root of any nested + chain
        if (
          node.parent &&
          node.parent.type === 'BinaryExpression' &&
          node.parent.operator === '+'
        ) {
          return;
        }

        const operands = [];
        function collect(n) {
          if (n.type === 'BinaryExpression' && n.operator === '+') {
            collect(n.left);
            collect(n.right);
          } else {
            operands.push(n);
          }
        }
        collect(node);

        const hasSqlLiteral = operands.some(
          (op) =>
            op.type === 'Literal' &&
            typeof op.value === 'string' &&
            containsSqlKeyword(op.value),
        );

        const hasNonLiteral = operands.some((op) => op.type !== 'Literal');

        if (hasSqlLiteral && hasNonLiteral) {
          context.report({
            node,
            messageId: 'noSqlBuilding',
          });
        }
      },
    };
  },
};
