import { graphql, buildSchema, GraphQLSchema } from 'graphql';
import { NextRequest, NextResponse } from 'next/server';
import { typeDefs } from '@/backend/src/graphql/schema';
import { resolvers } from '@/backend/src/graphql/resolvers';
import { createGraphQLContext } from '@/backend/src/graphql/context';
import { checkRateLimit, RateLimitError } from '@/backend/src/graphql/rate-limit';

let schema: GraphQLSchema;

function getSchema() {
  if (!schema) {
    const baseSchema = buildSchema(typeDefs);

    // Attach resolvers to the schema
    Object.keys(resolvers).forEach(typeName => {
      const type =
        typeName === 'Query'
          ? baseSchema.getQueryType()
          : typeName === 'Mutation'
            ? baseSchema.getMutationType()
            : baseSchema.getType(typeName);

      if (!type || !('_fields' in type)) return;

      Object.keys((resolvers as any)[typeName]).forEach(fieldName => {
        const field = (type._fields as any)[fieldName];
        if (field) {
          field.resolve = (resolvers as any)[typeName][fieldName];
        }
      });
    });

    schema = baseSchema;
  }
  return schema;
}

async function handleGraphQLRequest(req: NextRequest) {
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const ctx = await createGraphQLContext(req);

    // Check rate limit
    if (ctx.apiKeyId) {
      try {
        await checkRateLimit(ctx);
      } catch (error) {
        if (error instanceof RateLimitError) {
          return NextResponse.json(
            { errors: [{ message: error.message }] },
            { status: 429, headers: { 'Retry-After': String(error.retryAfter) } }
          );
        }
      }
    }

    const { query, variables, operationName } =
      req.method === 'GET'
        ? Object.fromEntries(new URL(req.url).searchParams)
        : await req.json();

    const result = await graphql({
      schema: getSchema(),
      source: query,
      variableValues: variables,
      operationName,
      contextValue: ctx,
    });

    const statusCode = result.errors ? 400 : 200;

    // Add rate limit headers
    const headers: Record<string, string> = {};
    if (ctx.apiKeyId) {
      headers['X-RateLimit-Limit'] = '100';
      headers['X-RateLimit-Window'] = '60';
    }

    return NextResponse.json(result, { status: statusCode, headers });
  } catch (error) {
    console.error('GraphQL error:', error);
    return NextResponse.json(
      { errors: [{ message: error instanceof Error ? error.message : 'Internal server error' }] },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleGraphQLRequest(req);
}

export async function POST(req: NextRequest) {
  return handleGraphQLRequest(req);
}

export async function OPTIONS(req: NextRequest) {
  return handleGraphQLRequest(req);
}
