import Redis from 'ioredis';

const nodes = [
  { host: '172.18.0.2', port: 6379 },
  { host: '172.18.0.3', port: 6379 },
  { host: '172.18.0.4', port: 6379 },
  { host: '172.18.0.5', port: 6379 },
  { host: '172.18.0.6', port: 6379 }
];

async function countUsersWithBalance(node, balance) {
  const client = new Redis(node);
  let cursor = '0';
  let count = 0;

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'users:*', 'COUNT', 100);
    cursor = nextCursor;

    const pipeline = client.pipeline();
    keys.forEach(key => pipeline.hget(key, 'balance'));
    const results = await pipeline.exec();

    results.forEach(([err, value]) => {
      if (value === balance.toString()) {
        count++;
      }
    });

  } while (cursor !== '0');

  client.disconnect();
  return count;
}

async function getTotalCount(balance) {
  const countPromises = nodes.map(node => countUsersWithBalance(node, balance));
  const counts = await Promise.all(countPromises);
  return counts.reduce((acc, count) => acc + count, 0);
}

getTotalCount(1700)
  .then(totalCount => {
    console.log(`Total number of users with a balance of exactly 1700 or less: ${totalCount}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('Error calculating total count:', err);
    process.exit(1);
  });
