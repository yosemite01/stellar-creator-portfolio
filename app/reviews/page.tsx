import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { ReviewAnalytics } from '@/components/review-analytics';

export default function ReviewsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-grow">
        <ReviewAnalytics />
      </main>
      
      <Footer />
    </div>
  );
}