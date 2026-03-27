use super::*;
use actix_web::{
    dev::{Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpMessage,
};
use futures_util::future::{ok, Ready};

pub struct AuthMiddleware;

impl<S> Transform<S, ServiceRequest> for AuthMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse, Error = Error> + 'static,
    S::Future: 'static,
{
    type Response = ServiceResponse;
    type Error = Error;
    type Transform = AuthMiddlewareInner<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(AuthMiddlewareInner { service })
    }
}

pub struct AuthMiddlewareInner<S> {
    service: S,
}

impl<S> Service<ServiceRequest> for AuthMiddlewareInner<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse, Error = Error> + 'static,
    S::Future: 'static,
{
    type Response = ServiceResponse;
    type Error = Error;
    type Future = impl futures::Future<Output = Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut std::task::Context<'_>) -> std::task::Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let claims_result = std::panic::AssertUnwindSafe(get_claims(&req))
            .catch_unwind()
            .await;

        let claims = match claims_result {
            Ok(Ok(claims)) => claims,
            _ => return Box::pin(async {
                Err(AuthError::InvalidToken(jsonwebtoken::errors::Error::ExpiredSignature).into())
            }),
        };

        let mut req = req;
        req.extensions_mut().insert(claims);
        let service = self.service.clone();
        Box::pin(async move {
            let res = service.call(req).await?;
            Ok(res)
        })
    }
}
