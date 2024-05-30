public class WaterPump_out {
    public static void main(String[] args) {
        int outpump = 0;   // 모비우스에 값 전달하는걸 변수로 그냥 놓아봤습니다
        int warmTime = 15; // 미지근 물 펌프가 작동한 시간 (초)
        int hotTime = 20;  // 뜨거운 물 펌프가 작동한 시간 (초)
        int wait_time = warmTime + hotTime;  // 물 빼는 시간 총합

        outpump = 1; // 물 빼는 펌프에 1 전달하는거

        try {
            Thread.sleep(wait_time * 1000); // 지정된 시간 동안 대기 (밀리초로 변환)
        } catch (InterruptedException e) {
            e.printStackTrace();
        }

        outpump = 0; // 물 빼는 펌프에 0 전달하는거
    }
}
