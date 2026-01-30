
import { RoolClient } from '../dist/index.js';
import { NodeAuthProvider } from '../dist/auth-node.js';

const BASE_URL = 'https://api.dev.rool.dev';

async function main() {
    console.log('Initializing client...');
    const client = new RoolClient({
        baseUrl: BASE_URL,
        authProvider: new NodeAuthProvider()
    });

    // Log auth state
    client.on('authStateChanged', (auth) => {
        console.log('Auth state changed:', auth);
    });

    try {
        if (!client.isAuthenticated()) {
            console.log('Not authenticated. Logging in (check your browser)...');
            await client.login();
            console.log('Login successful!');
        } else {
            console.log('Already authenticated (loaded from file).');
        }

        const user = client.getUser();
        console.log('Logged in user:', user);

        console.log('Listing spaces...');
        const spaces = await client.listSpaces();
        console.log(`Found ${spaces.length} spaces:`);
        spaces.forEach(s => {
            console.log(`- ${s.name} (${s.id}) [${s.role}]`);
        });

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
