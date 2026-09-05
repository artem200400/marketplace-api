CREATE ROLE marketplace_user
WITH LOGIN
PASSWORD 'marketplace_password';

CREATE DATABASE marketplace
OWNER marketplace_user;