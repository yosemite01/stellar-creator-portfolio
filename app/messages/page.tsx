import ChatInterface from '@/components/chat-interface'

export const metadata = {
  title: 'Messages | Stellar Creators',
  description: 'Real-time messaging between clients and creators',
}

export default function MessagesPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Messaging</p>
        <h1 className="text-3xl font-semibold">Real-time collaboration</h1>
        <p className="text-muted-foreground">Chat live, share files, and keep requirements clear across projects.</p>
      </header>
      <ChatInterface />
    </main>
  )
}
