// Jest doesn't read .env. Give tests a fixed, fake API URL (real requests are always mocked).
process.env.EXPO_PUBLIC_API_URL = 'https://api.lunti.test/api/v1';
