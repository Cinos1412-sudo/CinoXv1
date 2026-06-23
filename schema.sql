CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  bio TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  location VARCHAR(100) DEFAULT 'Antananarivo',
  phone_mvola VARCHAR(20) DEFAULT '',
  phone_orange VARCHAR(20) DEFAULT '',
  phone_airtel VARCHAR(20) DEFAULT '',
  is_verified BOOLEAN DEFAULT false,
  email_verified BOOLEAN DEFAULT false,
  otp_code VARCHAR(6),
  otp_expires_at TIMESTAMP,
  sales_count INTEGER DEFAULT 0,
  rating NUMERIC(3,1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  price BIGINT NOT NULL,
  category VARCHAR(50) DEFAULT 'Tech',
  state VARCHAR(50) DEFAULT 'Bon état',
  location VARCHAR(100) DEFAULT 'Antananarivo',
  images TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  views INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  buyer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  payment_status VARCHAR(20) DEFAULT 'none',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(buyer_id, seller_id, product_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  type VARCHAR(20) DEFAULT 'text',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50),
  data JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO users (username, email, password_hash, display_name, bio, location, phone_mvola, phone_orange, is_verified, sales_count, rating)
VALUES
  ('alice.rakoto', 'alice@cinox.mg', '$2a$10$CvwZs5MkcnLpDky/uvQG4OfhCQjRXYarQgpet1UohtQS2drdy00Ci', 'Alice Rakoto', 'Passionnée de tech & mode vintage 📱👗 Livraison partout à Madagascar 🇲🇬', 'Antananarivo', '034 12 345 67', '032 98 765 43', true, 24, 4.9),
  ('andry.tech', 'andry@cinox.mg', '$2a$10$CvwZs5MkcnLpDky/uvQG4OfhCQjRXYarQgpet1UohtQS2drdy00Ci', 'TechAndry', 'Revendeur matériel tech certifié 🔧 Antananarivo', 'Antananarivo', '034 55 678 90', '', true, 18, 4.8),
  ('marie.mode', 'marie@cinox.mg', '$2a$10$CvwZs5MkcnLpDky/uvQG4OfhCQjRXYarQgpet1UohtQS2drdy00Ci', 'MarieMode', 'Mode vintage & tendance à Mahajanga 👗', 'Mahajanga', '032 11 222 33', '034 44 555 66', true, 31, 4.9),
  ('tom.games', 'tom@cinox.mg', '$2a$10$CvwZs5MkcnLpDky/uvQG4OfhCQjRXYarQgpet1UohtQS2drdy00Ci', 'GameTom', 'Jeux vidéo & consoles 🎮 Toamasina', 'Toamasina', '', '033 77 888 99', false, 12, 4.7)
ON CONFLICT DO NOTHING;

INSERT INTO products (seller_id, title, description, price, category, state, location, images)
VALUES
  (2, 'iPhone 14 Pro – 256Go', 'iPhone 14 Pro en excellent état, peu utilisé. Batterie à 94%. Vendu avec boîte originale, chargeur et câble. Déblocage opérateur effectué.', 4400000, 'Tech', 'Très bon état', 'Antananarivo', ARRAY['https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?w=600&h=600&fit=crop']),
  (3, 'Veste en cuir vintage', 'Belle veste en cuir vintage des années 90. Taille M. Quelques légères marques d''usure qui font son charme. Livraison disponible.', 220000, 'Mode', 'Bon état', 'Mahajanga', ARRAY['https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&h=600&fit=crop']),
  (4, 'PS5 + 2 manettes', 'PS5 avec 2 manettes DualSense. Fonctionne parfaitement. Pack complet avec câbles.', 2050000, 'Jeux', 'Très bon état', 'Toamasina', ARRAY['https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&h=600&fit=crop']),
  (3, 'Table basse scandinave', 'Table basse style scandinave en bois clair. 120x60x45cm. Légères marques d''utilisation.', 370000, 'Maison', 'Bon état', 'Mahajanga', ARRAY['https://images.unsplash.com/photo-1533090481720-856c6e3c1fdc?w=600&h=600&fit=crop']),
  (2, 'Nike Air Force 1 – T42', 'Nike Air Force 1 taille 42. Jamais portées, encore dans la boîte.', 415000, 'Sport', 'Neuf', 'Antananarivo', ARRAY['https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&h=600&fit=crop']),
  (2, 'MacBook Air M2', 'MacBook Air M2, 8Go RAM, 256Go SSD. Batterie à 98%. Vendu avec chargeur MagSafe.', 5635000, 'Tech', 'Très bon état', 'Antananarivo', ARRAY['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&h=600&fit=crop']),
  (1, 'Vélo de ville Peugeot', 'Vélo de ville Peugeot 7 vitesses. Cadre aluminium. Révisé récemment.', 588000, 'Sport', 'Bon état', 'Antananarivo', ARRAY['https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=600&h=600&fit=crop']),
  (2, 'Canon EOS 90D + objectif', 'Canon EOS 90D avec objectif 18-135mm. Environ 15 000 déclenchements. Vendu avec 2 batteries.', 1715000, 'Tech', 'Bon état', 'Antananarivo', ARRAY['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&h=600&fit=crop'])
ON CONFLICT DO NOTHING;

INSERT INTO follows (follower_id, following_id) VALUES (1,2),(1,3),(2,3),(4,2) ON CONFLICT DO NOTHING;
INSERT INTO likes (user_id, product_id) VALUES (1,1),(1,3),(2,2),(3,6) ON CONFLICT DO NOTHING;
