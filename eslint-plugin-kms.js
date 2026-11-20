/**
 * ESLint plugin to ban direct process.env secret reads
 * 
 * Rule: kms/no-direct-env-read
 * 
 * Flags any direct access to process.env for known secret names.
 */

module.exports = {
  rules: {
    'no-direct-env-read': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Ban direct process.env reads for secret values',
          category: 'Possible Errors',
          recommended: true,
        },
        schema: [],
        messages: {
          noDirectEnv: 'Do not read secrets directly from process.env. Use getSecretValue() from @/server/services/secrets instead.',
        },
      },
      create(context) {
        return {
          MemberExpression(node) {
            // Match process.env.SECRET_NAME patterns
            if (
              node.object.type === 'Identifier' &&
              node.object.name === 'process' &&
              node.property.type === 'Identifier' &&
              isSecretName(node.property.name)
            ) {
              context.report({
                node,
                messageId: 'noDirectEnv',
              });
            }
          },
        };
      },
    },
  },
};

/**
 * List of secret names that should not be accessed directly from process.env
 */
function isSecretName(name) {
  const secretNames = [
    // Authentication & Identity
    'JWT_SECRET',
    'NEXTAUTH_SECRET',
    'WEBHOOK_SECRET',
    
    // Payment Processing
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    
    // Storage & Cloud
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'AWS_REGION',
    
    // Database
    'DATABASE_URL',
    'REDIS_URL',
    
    // Email
    'RESEND_API_KEY',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'AWS_SES_REGION',
    'SES_REGION',
    
    // Monitoring & Logging
    'SENTRY_DSN',
    'NEXT_PUBLIC_SENTRY_DSN',
    
    // Encryption
    'ENCRYPTION_KEY',
    
    // Stellar
    'STELLAR_ADMIN_SECRET',
    'STELLAR_FEE_ACCOUNT_SECRET',
    
    // OAuth
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    
    // Feature Flags
    'FEATURE_FLAG_SECRET',
    
    // Custom secrets
    'API_KEY',
    'SECRET_KEY',
    'PRIVATE_KEY',
    'ACCESS_TOKEN',
    'REFRESH_TOKEN',
  ];
  
  return secretNames.includes(name);
}