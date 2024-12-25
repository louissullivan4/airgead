SET search_path TO public;

DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS users;

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    fname VARCHAR(255) NOT NULL,
    mname VARCHAR(255),
    sname VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone_number VARCHAR(50),
    date_of_birth DATE NOT NULL,
    ppsno VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'EUR',
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    county VARCHAR(100),
    country VARCHAR(100),
    tax_status VARCHAR(50),
    marital_status VARCHAR(50),
    postal_code VARCHAR(20),
    occupation VARCHAR(100),
    password_hash VARCHAR(255) NOT NULL,
    inviter_id VARCHAR(50) DEFAULT '0',
    id_image_url VARCHAR(250) DEFAULT NULL,
    role VARCHAR(50) DEFAULT 'client',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    subscription_level VARCHAR(50) DEFAULT 'free',
    account_status VARCHAR(50) DEFAULT 'active',
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_auto_renew BOOLEAN DEFAULT TRUE,
    payment_method VARCHAR(50) DEFAULT NULL,
    renewal_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    poa_image_url VARCHAR(250) DEFAULT NULL
);

CREATE TABLE expenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'EUR',
    receipt_image_url VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT expenses_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

INSERT INTO users (fname, sname, email, phone_number, date_of_birth, ppsno, currency, address_line1, address_line2, city, county, country, tax_status, marital_status, postal_code, occupation, password_hash, role, inviter_id, id_image_url)
VALUES
    ('Louis', 'Sullivan', 'louis@admin.com', '0834754340', '2001-05-16', '123456A', 'EUR', 'Castletown, Tramore, Waterford', '', 'Waterford', 'Waterford', 'Ireland', 'Employed', 'Single', 'T12 XYZ0', 'Software Engineer', '$2a$10$l8jiU.0TSZOXVCHWYg0n4e.UELkGYlmBxa.IrqV1KoMTzCx8WPfLK', 'admin', '0', 'https://storage.googleapis.com/equiledger-upload-images/ids/cbb6019c-5ec7-483f-bdd2-284aa65bab70.jpeg'),
    ('Kyle', 'Sullivan', 'kyle@admin.com', '0834754340', '2001-05-16', '123456A', 'EUR', 'Castletown, Tramore, Waterford', '', 'Waterford', 'Waterford', 'Ireland', 'Employed', 'Single', 'T12 XYZ0', 'Accountant', '$2a$10$l8jiU.0TSZOXVCHWYg0n4e.UELkGYlmBxa.IrqV1KoMTzCx8WPfLK', 'accountant', '0', 'https://storage.googleapis.com/equiledger-upload-images/ids/cbb6019c-5ec7-483f-bdd2-284aa65bab70.jpeg'),
    ('Evan', 'Sullivan', 'evan@admin.com', '0834754340', '2001-05-16', '123456A', 'EUR', 'Castletown, Tramore, Waterford', '', 'Waterford', 'Waterford', 'Ireland', 'Employed', 'Single', 'T12 XYZ0', 'Waiter', '$2a$10$l8jiU.0TSZOXVCHWYg0n4e.UELkGYlmBxa.IrqV1KoMTzCx8WPfLK', 'client', '1', 'https://storage.googleapis.com/equiledger-upload-images/ids/cbb6019c-5ec7-483f-bdd2-284aa65bab70.jpeg');

INSERT INTO expenses (user_id, title, description, category, amount, currency, receipt_image_url)
VALUES
    (1, 'Phone Bill', '3 monthly data', 'mobile', 20.00, 'EUR', 'https://storage.googleapis.com/equiledger-upload-images/ids/cbb6019c-5ec7-483f-bdd2-284aa65bab70.jpeg'),
    (2, 'Emergency Vet Call', 'Assisting with a vet call and related expenses', 'healthcare', 250.00, 'EUR', 'https://storage.googleapis.com/equiledger-upload-images/ids/cbb6019c-5ec7-483f-bdd2-284aa65bab70.jpeg'),
    (3, 'Grooming Supplies', 'Shampoo, conditioner, and brushes for grooming', 'equipment', 60.99, 'EUR', 'https://storage.googleapis.com/equiledger-upload-images/ids/cbb6019c-5ec7-483f-bdd2-284aa65bab70.jpeg'),
    (3, 'Diesel', 'Weekly car fuel', 'motor-fuel', 80.00, 'EUR', 'https://storage.googleapis.com/equiledger-upload-images/ids/cbb6019c-5ec7-483f-bdd2-284aa65bab70.jpeg');
