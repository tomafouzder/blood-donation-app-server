const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express')
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 3000
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: "unauthorize access" })
    }

    try {
        const idToken = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(idToken)
        console.log("decoded info", decoded)
        req.decoded_email = decoded.email;
        next();
    } catch (error) {
        return res.status(401).send({ message: "unauthorize access" })
    }

}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ioz0rr9.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const database = client.db('bloodDonationDB')
        const usersCollection = database.collection('users')
        const requestCollection = database.collection('request')
        const paymentsCollection = database.collection('payments')


        // user register data post 
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            userInfo.role = userInfo?.role || 'donor';
            userInfo.status = 'active'
            userInfo.createAt = new Date();

            const result = await usersCollection.insertOne(userInfo)
            res.send(result)
        })

        // all user get
        app.get('/users', verifyFBToken, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.status(200).send(result)
        })

        // get single profile info
        app.get('/users/profile', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const result = await usersCollection.findOne({ email });
            res.send(result);
        });

        // update profile
        app.put('/users/profile', verifyFBToken, async (req, res) => {
            try {
                const email = req.decoded_email;
                const data = req.body;

                if (!email) {
                    return res.status(401).send({ message: "Unauthorized" });
                }

                delete data._id;
                delete data.email;
                delete data.password;
                delete data.role;
                delete data.status;
                delete data.createAt;

                data.updatedAt = new Date();

                const result = await usersCollection.updateOne(
                    { email },
                    { $set: data }
                );

                res.send({
                    success: true,
                    matchedCount: result.matchedCount,
                    modifiedCount: result.modifiedCount
                });

            } catch (error) {
                console.error("PROFILE UPDATE ERROR:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // get for user role set
        app.get('/users/role/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email }

            const result = await usersCollection.findOne(query)

            res.send(result)
        })

        // update status by admin
        app.patch('/update/user/status', verifyFBToken, async (req, res) => {
            const { email, status } = req.query;
            const query = { email: email };

            const updateStatus = {
                $set: {
                    status: status
                }
            }
            const result = await usersCollection.updateOne(query, updateStatus)
            res.send(result)
        })



        // DONOR APIS:
        // send post request
        app.post('/requests', verifyFBToken, async (req, res) => {
            const data = req.body;
            data.createAt = new Date();
            const result = await requestCollection.insertOne(data)
            res.send(result);
        })
        // my-request 
        app.get('/my-request', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const size = Number(req.query.size);
            const page = Number(req.query.page);

            const query = { requesterEmail: email };

            const result = await requestCollection
                .find(query)
                .limit(size)
                .skip(size * page)
                .toArray();

            const totalRequest = await requestCollection.countDocuments(query);

            res.send({ request: result, totalRequest })
        })
        //  resent-request for donor dashboard 
        app.get('/resent-request', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const query = { requesterEmail: email };

            const cursor = requestCollection
                .find(query)
                .sort({
                    createdAt: -1,
                    updatedAt: -1,
                })
                .limit(3);
            const result = await cursor.toArray();
            res.send(result);
        })
        // update status
        app.patch('/update/request/status', verifyFBToken, async (req, res) => {
            const { id, status, donorName, donorEmail } = req.body;
            const query = { _id: new ObjectId(id) };

            const updateStatus = {
                $set: {
                    status: status,
                    donorName: donorName,
                    donorEmail: donorEmail,
                    updatedAt: new Date()
                }
            }
            const result = await requestCollection.updateOne(query, updateStatus)
            res.send(result)
        })
        // delete request
        app.delete('/delete-request/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await requestCollection.deleteOne(query)
            res.send(result)
        })
        // get search-request donor info  
        app.get('/search-requests', async (req, res) => {
            const { bloodGroup, district, upazila } = req.query;

            const query = {};

            if (!query) {
                return;
            }

            if (bloodGroup) {
                const fixed = bloodGroup.replace(/ /g, "+").trim();
                query.bloodGroup = fixed
            }
            if (district) {
                query.district = district;
            }
            if (upazila) {
                query.upazila = upazila;
            }
            console.log(query)

            const result = await requestCollection.find(query).toArray();
            res.send(result)
        })


        // ADMIN APIS
        // all request 
        app.get('/all-requests', async (req, res) => {
            const size = Number(req.query.size);
            const page = Number(req.query.page);

            const query = {};

            const result = await requestCollection
                .find(query)
                .limit(size)
                .skip(size * page)
                .toArray();
            const total = await requestCollection.countDocuments(query);
            res.status(200).send({ request: result, total })
        })
        // request details
        app.get('/all-requests/:id', verifyFBToken, async (req, res) => {
            const { id } = req.params;
            console.log(id);
            const result = await requestCollection.findOne({ _id: new ObjectId(id) })
            res.send({
                success: true,
                result
            })
        })
        // update all request info
        app.put('/all-requests/:id', verifyFBToken, async (req, res) => {
            const { id } = req.params;
            const data = req.body;
            const objectId = new ObjectId(id);
            const filter = { _id: objectId }

            data.updatedAt = new Date();

            const update = {
                $set: data
            }
            const result = await requestCollection.updateOne(filter, update)
            res.send({

                success: true,
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount
            })
        })



        // PAYMENT APIS
        // post payment and create payment page
        app.post('/create-payment-checkout', async (req, res) => {
            const information = req.body;
            const amount = parseInt(information.donateAmount) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: 'Please Donate'
                            },
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    donorName: information?.donorName
                },
                customer_email: information?.userDonorEmail,
                success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
            });

            res.send({ url: session.url })

        })
        // post success payment and save database
        app.post('/success-payment', async (req, res) => {
            const { session_id } = req.query;
            const session = await stripe.checkout.sessions.retrieve(
                session_id
            );
            console.log(session);

            const transactionId = session.payment_intent;

            const isPaymentExist = await paymentsCollection.findOne({ transactionId })

            if (isPaymentExist) {
                return res.status(400).send('Already Exist')
            }

            if (session.payment_status == 'paid') {
                const paymentInfo = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    donorEmail: session.customer_email,
                    transactionId,
                    payment_status: session.payment_status,
                    paidAt: new Date(),
                }

                const result = await paymentsCollection.insertOne(paymentInfo)
                return res.send(result)
            }
        })




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Blood Donations')
})

app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})