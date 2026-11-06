// Register all games here – the menu shows them in this order.
import { registerGame } from './registry';
import { MineTime } from './minetime/MineTime';

registerGame({
  id: 'minetime',
  title: 'Mine Time',
  subtitle: 'Grabe dich durch die Höhle!',
  color: 0xd9822b,
  create: () => new MineTime(),
});
