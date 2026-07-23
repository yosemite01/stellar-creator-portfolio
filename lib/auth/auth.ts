import { getServerSession as nextAuthGetServerSession } from 'next-auth';
import { authOptions } from './config';

export function getServerSession() {
  return nextAuthGetServerSession(authOptions);
}
