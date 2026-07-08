FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY main.go .
RUN go mod init artist-images && go mod tidy && go build -o artist-images .

FROM debian:bookworm-slim
COPY --from=builder /app/artist-images /artist-images
EXPOSE 8080
CMD ["/artist-images"]
