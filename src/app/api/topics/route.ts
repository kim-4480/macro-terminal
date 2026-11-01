import type { TopicInfo } from '@/shared/types';
import { route } from '@/server/api';
import { topicInfo, topics } from '@/server/news-intel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings, portfolio }): TopicInfo[] => topics(settings, portfolio).map(topicInfo));
