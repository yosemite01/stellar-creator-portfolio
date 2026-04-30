'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Quest {
  id: string;
  title: string;
  description: string;
  reward: number;
  difficulty: 'easy' | 'medium' | 'hard';
  completed: boolean;
}

const QUESTS: Quest[] = [
  {
    id: '1',
    title: 'Complete Profile',
    description: 'Fill out your creator profile',
    reward: 100,
    difficulty: 'easy',
    completed: false,
  },
  {
    id: '2',
    title: 'First Bounty',
    description: 'Complete your first bounty',
    reward: 500,
    difficulty: 'medium',
    completed: false,
  },
  {
    id: '3',
    title: 'Five Star Rating',
    description: 'Achieve a 5-star rating',
    reward: 1000,
    difficulty: 'hard',
    completed: false,
  },
];

export default function QuestsPage() {
  const [completedQuests, setCompletedQuests] = useState<Set<string>>(new Set());

  // Use useMemo to derive computed state instead of useEffect
  const questStats = useMemo(() => {
    const completed = completedQuests.size;
    const total = QUESTS.length;
    const totalReward = QUESTS.filter((q) => completedQuests.has(q.id)).reduce(
      (sum, q) => sum + q.reward,
      0
    );

    return { completed, total, totalReward };
  }, [completedQuests]);

  const handleCompleteQuest = (questId: string) => {
    setCompletedQuests((prev) => {
      const next = new Set(prev);
      if (next.has(questId)) {
        next.delete(questId);
      } else {
        next.add(questId);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Quests</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          Complete quests to earn rewards and unlock achievements
        </p>

        {/* Stats Card */}
        <Card className="mb-8 p-6">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Completed</p>
              <p className="text-3xl font-bold">
                {questStats.completed}/{questStats.total}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Reward</p>
              <p className="text-3xl font-bold">{questStats.totalReward}</p>
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Progress</p>
              <p className="text-3xl font-bold">
                {Math.round((questStats.completed / questStats.total) * 100)}%
              </p>
            </div>
          </div>
        </Card>

        {/* Quests List */}
        <div className="space-y-4">
          {QUESTS.map((quest) => (
            <Card
              key={quest.id}
              className={`p-6 transition-all ${
                completedQuests.has(quest.id)
                  ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold mb-2">{quest.title}</h3>
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    {quest.description}
                  </p>
                  <div className="flex items-center gap-4">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        quest.difficulty === 'easy'
                          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                          : quest.difficulty === 'medium'
                            ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                            : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                      }`}
                    >
                      {quest.difficulty}
                    </span>
                    <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                      +{quest.reward} points
                    </span>
                  </div>
                </div>
                <Button
                  onClick={() => handleCompleteQuest(quest.id)}
                  variant={completedQuests.has(quest.id) ? 'default' : 'outline'}
                  className="ml-4"
                >
                  {completedQuests.has(quest.id) ? '✓ Completed' : 'Complete'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
