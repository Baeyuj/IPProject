import java.util.Scanner;

public class WaterPump_in {
    // 변수 선언
    private static int waterLevel = 0; // 수위 값
    private static int setTemp = 0; // 설정 온도
    private static int currentTemp = 0; // 현재 온도
    private static int warmWaterPump = 0; // 미지근 물 펌프
    private static int hotWaterPump = 0; // 뜨거운 물 펌프

    // 미지근한 물 펌프를 일정 시간 동안 작동시키는 함수
    public static void activateWarmWaterPump(int duration) {
        warmWaterPump = 1;
        System.out.println("Warm water pump is ON.");
        try {
            Thread.sleep(duration * 1000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        warmWaterPump = 0;
        System.out.println("Warm water pump is OFF.");
    }

    // 뜨거운 물 펌프를 작동시키는 함수
    public static void activateHotWaterPump() {
        hotWaterPump = 1;
        System.out.println("Hot water pump is ON.");
    }

    // 펌프를 모두 끄는 함수
    public static void deactivatePumps() {
        warmWaterPump = 0;
        hotWaterPump = 0;
        System.out.println("Both water pumps are OFF.");
    }

    // 미지근 물 펌프 켜는 함수
    public static void controlTemperature() {
        warmWaterPump = 1;
    }

    public static void main(String[] args) {
        long start, end;
        long warmTime = 0; // 미물 시간
        long hotTime = 0; // 뜨물 시간

        try (Scanner scanner = new Scanner(System.in)) {
            // 설정 수온 입력
            System.out.print("Enter the desired water temperature: ");
            setTemp = scanner.nextInt();

            // 미지근한 물 펌프 작동 (10초)
            activateWarmWaterPump(10);
            warmTime += 10;

            start = System.currentTimeMillis();
            // 뜨거운 물 펌프 작동
            activateHotWaterPump();

            // 온도 제어
            while (currentTemp < setTemp) {
                try {
                    Thread.sleep(1000); // 설정 온도 도달 전까지 sleep 1초 반복
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
                currentTemp++; // 현재 온도 증가 시뮬레이션
            }
            end = System.currentTimeMillis();
            hotTime = (end - start) / 1000; // 경과 시간 계산

            start = System.currentTimeMillis();
            // 미지근 물 나옴
            controlTemperature();

            while (waterLevel < 0) {
                try {
                    Thread.sleep(1000); // 수위 도달 전까지 sleep 1초 반복
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }

            deactivatePumps();
            end = System.currentTimeMillis();

            hotTime += (end - start) / 1000; // 경과 시간 계산
            warmTime += (end - start) / 1000; // 경과 시간 계산

            System.out.println("Warm water pump was on for " + warmTime + " seconds.");
            System.out.println("Hot water pump was on for " + hotTime + " seconds.");
        } // try-with-resources 블록은 여기에 종료되어 scanner가 자동으로 닫힙니다.
    }
}
