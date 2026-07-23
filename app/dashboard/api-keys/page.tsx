import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";

export const metadata = {
  title: "API Keys | Stellar Creators",
  description: "Manage developer API keys for third-party integrations",
};

export default function ApiKeysPage() {
  return (
    <div className="container max-w-3xl py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-muted-foreground mt-1">
          Generate and manage API keys for programmatic access to the GraphQL API.
        </p>
      </div>
      <ApiKeysManager />
    </div>
  );
}
