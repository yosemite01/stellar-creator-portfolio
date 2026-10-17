import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { ChatInterface } from '@/components/messaging/chat-interface';

export const metadata = {
  title: 'Messages | Tamgora',
  description: 'Real-time end-to-end encrypted messaging between clients and creators.',
};

export default function MessagesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow container max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
          <p className="text-muted-foreground mt-1">
            Real-time, secure communication for project milestones, deliverables, and inquiries.
          </p>
        </div>
        <ChatInterface />
      </main>
      <Footer />
    </div>
  );
}
