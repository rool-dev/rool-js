
import { RoolClient } from '@rool-dev/client';
import { NodeAuthProvider } from '@rool-dev/client/node';

async function main() {
    const client = new RoolClient({
        baseUrl: 'https://api.dev.rool.dev',
        authProvider: new NodeAuthProvider({
            credentialsPath: './tokens.json' // Save tokens locally (optional)
        })
    });

    // This will open the browser if not logged in
    if (!client.isAuthenticated()) {
        await client.login();
    }

    const user = await client.getCurrentUser();
    console.log('Logged in as:', user.email);
}
