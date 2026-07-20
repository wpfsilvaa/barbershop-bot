-- Add photo_url column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Seed default photos for Juliano and Caciano to make the client booking webapp look premium immediately
UPDATE users 
SET photo_url = 'https://images.unsplash.com/photo-1621574539437-4b7cb63120b8?auto=format&fit=crop&q=80&w=300&h=300'
WHERE email = 'juliano@barbearia.com';

UPDATE users 
SET photo_url = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300&h=300'
WHERE email = 'caciano@barbearia.com';
