const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

try {
  let schema = fs.readFileSync(schemaPath, 'utf8');
  
  // 检查环境变量 DEPLOY_TARGET
  // 在腾讯云云托管构建环境中，通常可以设置环境变量
  // 或者我们默认如果不是 Vercel 环境，就可能是腾讯云
  // 这里严格判断 DEPLOY_TARGET
  const target = process.env.DEPLOY_TARGET || process.env.NEXT_PUBLIC_DEPLOY_TARGET;

  console.log(`Current DEPLOY_TARGET: ${target}`);

  if (target === 'tencent') {
    console.log('Adapting Prisma schema for Tencent Cloud (MySQL)...');
    if (schema.includes('provider = "postgresql"')) {
      schema = schema.replace('provider = "postgresql"', 'provider = "mysql"');
      fs.writeFileSync(schemaPath, schema);
      console.log('✅ Successfully switched Prisma provider to MySQL.');
    } else {
      console.log('ℹ️ Prisma provider is already configured (or not PostgreSQL).');
    }
  } else {
    console.log('Keeping existing Prisma schema configuration (likely PostgreSQL for Vercel).');
  }
} catch (err) {
  console.error('Error adapting schema:', err);
  process.exit(1);
}
