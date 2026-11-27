// '@nestjs/platform-express' 대체품. 파일 올리기는 브라우저 틀이 File 을 그대로 넘긴다(UploadedFile).
export const FileInterceptor = (_field: string, _opts?: unknown) => class {};
