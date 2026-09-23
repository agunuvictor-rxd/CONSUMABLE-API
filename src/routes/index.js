import { Router } from 'express';
import restaurantsRouter from './restaurants.js';
import menuItemsRouter from './menuItems.js';
import ordersRouter from './orders.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

router.use('/restaurants', restaurantsRouter);
router.use('/menu-items', menuItemsRouter);
router.use('/orders', ordersRouter);

export default router;