import express from 'express';
import Redis from 'ioredis';
import Redlock from 'redlock';
import bodyParser from 'body-parser';
import { createHash } from 'crypto';

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

const cluster = new Redis.Cluster([
	{host: "172.18.0.2", port: 6379},
	{host: "172.18.0.3", port: 6379},
	{host: "172.18.0.4", port: 6379},
	{host: "172.18.0.5", port: 6379},
	{host: "172.18.0.6", port: 6379}
])

const redlock = new Redlock(
    [cluster],
    {
        driftFactor: 0.01,
        retryCount:  2,
        retryDelay:  1000,
        retryJitter:  1000
    }
);

// ----------------------------------------- AUTH -----------------------------------------
app.post('/register', async (req, res) => {
    const { username, password, fullname, email } = req.body;

    if (!username) {
        return res.status(400).json({ "error": "Username is required" });
    }

    if (!password) {
        return res.status(400).json({ "error": "Password is required" });
    }

    const exists = await cluster.exists(`users:${username}`);
    if (exists) {
        return res.status(409).json({ "error": "Username already exists" });
    }

    
    const hashedPassword = createHash('sha256').update(password).digest('hex');

    const userKey = `users:${username}`;
    await cluster.hmset(userKey, {
        'fullname': fullname || '',
        'username': username,
        'email': email || '',
        'password': hashedPassword,
        'balance': 2000
    });

    res.status(201).json({ "message": "User registered successfully" });
});



// ----------------------------------------- TICKETS -----------------------------------------
app.get('/ticket/:seatId', async (req, res) => {
    const seatId = req.params.seatId;
    console.log(seatId)
    if (!seatId) {
        return res.status(400).json({"error": "Seat ID is required"});
    }

    const ticketKey = `ticket:${seatId}`;
    try {
        const ticketInfo = await cluster.hgetall(ticketKey);
        if (Object.keys(ticketInfo).length === 0) {
            return res.status(404).json({"error": "Ticket not found"});
        }
        res.json(ticketInfo);
    } catch (error) {
        console.error('Redis error:', error);
        res.status(500).json({"error": "Server error"});
    }
});

app.get('/ticket', async (req, res) => {
    try {
        const keys = await cluster.keys('ticket:*'); // get all keys that match 'ticket:*'
        const tickets = [];

        for (const key of keys) {
            const ticketDetails = await cluster.hgetall(key);
            if (ticketDetails) {
                tickets.push({ key, ...ticketDetails });
            }
        }

        res.json(tickets);
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ error: "Failed to retrieve tickets from Redis" });
    }
});

app.get('/mytickets', async(req, res) =>{
    const userId = req.query.username;
    if (!userId) {
        return res.status(400).json({"error": "username is required"});
    }

    const userTicketsKey = `user:tickets:${userId}`;

    cluster.smembers(userTicketsKey, (err, ticketIds) => {
        if (err) {
            console.error('Error retrieving ticket IDs:', err);
            return;
        }
       res.status(200).send({"Ticket IDs": ticketIds});
    });
})

app.post('/buyTicket', async (req, res) => {
    const username = req.body.username;
    const ticketId = req.body.ticketId;
    if (!username || !ticketId) {
        return res.status(400).json({"error": "Username and Seat ID are required"});
    }

    const ticketKey = `ticket:${ticketId}`;
    const resourceKey = `locks:${ticketKey}`;
    const userKey = `users:${username}`;
    const userResourceKey = `locks:${userKey}`;

    try {
        let ticketLock = await redlock.acquire([resourceKey], 15 * 1000); // attempt to acquire a lock on the resource
        let userLock = await redlock.acquire([userResourceKey], 15 * 1000);

        console.log(`Setting a lock on ${ticketKey} and ${userKey}`)

        try {
            const ticketInfo = await cluster.hgetall(ticketKey);
            const userInfo = await cluster.hgetall(userKey);

            if (!ticketInfo || Object.keys(ticketInfo).length === 0) {
                return res.status(404).json({"error": "Ticket not found"});
            }
            if (ticketInfo.status === 'sold') {
                return res.status(400).json({"error": "Ticket is already sold"});
            }
            if (!userInfo || Object.keys(userInfo).length === 0) {
                return res.status(404).json({"error": "User not found"});
            }
            await new Promise(resolve => setTimeout(resolve, 10000));

            const ticketPrice = parseFloat(ticketInfo.price);
            const userBalance = parseFloat(userInfo.balance);

            if (userBalance < ticketPrice) {
                return res.status(400).json({"error": "Insufficient balance"});
            }
            
            await cluster.hset(ticketKey, 'status', 'sold');
            await cluster.hset(ticketKey, 'buyer', username);

            const userTicketsKey = `user:tickets:${username}`; //a set to keep track of all tickets bought by a user
            await cluster.sadd(userTicketsKey, ticketId);

            const newBalance = userBalance - ticketPrice;
            await cluster.hset(userKey, 'balance', newBalance.toString());

            res.status(200).json({"message": `Ticket ${ticketId} successfully purchased by ${username}`});
        } catch (e) {
            console.log(`Error setting value on ${ticketKey}`)
        } finally {
            await userLock.release();
            await ticketLock.release();
        }
    } catch (error) {
        console.log('Error acquiring the lock:', error);
        res.status(403).json({"error": "Ticket is currently being purchased by another user"});
    }
});


// ---------------------------- EVENTS ----------------------------------
app.post('/createEvent', async (req, res) => {
    const event_name = req.body.event_name;
    const price = req.body.price;
    const rows = req.body.rows || 2;
    const seats_per_row = req.body.seats || 5;

    if (!event_name || !price) {
        return res.status(400).json({ "error": "Event name and price are required" });
    }
    if (typeof rows !== 'number' || typeof seats_per_row !== 'number' || rows <= 0 || seats_per_row <= 0) {
        return res.status(400).json({ "error": "Rows and seats per row must be positive integers" });
    }

    try {
        for (let row = 1; row <= rows; row++) {
            for (let seat = 1; seat <= seats_per_row; seat++) {
                const seat_id = `${row}-${seat}`;
                const ticket_key = `ticket:${seat_id}`;
                await cluster.hmset(ticket_key, {
                    'seat': seat_id,
                    'status': 'available',
                    'event': event_name,
                    'price': price
                });
            }
        }
        res.status(201).json({ "message": "Tickets initialized successfully" });
    } catch (error) {
        console.error('Redis error:', error);
        res.status(500).json({ "error": "Server error" });
    }
});

app.listen(port, () => {
    console.log(`Listening at http://localhost:${port}`);
});
