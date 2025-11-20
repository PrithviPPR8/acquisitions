import express from "express"

const router = express.Router();

router.get('/', (req, res) => res.send('GET /users'));
router.get('/:id', (req, res) => res.send('GET /users/:id'));
router.put('/:id', (req, res) => res.send('PUT /users/:id'));
router.delete('/:id', (req, res) => res.send('DELETE /users/:id'));

export default router;