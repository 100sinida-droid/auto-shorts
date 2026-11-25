// 여행지 데이터
// plug: 'ok'   = 한국 플러그(C/F형) 그대로 사용 가능
//       'no'   = 어댑터 필요
//       'mixed'= 숙소마다 다름 → 어댑터 챙기기 권장
// voltage: 현지 전압(V). 한국은 220V
// flight: 인천 기준 대략 비행시간(시간). 국내는 0
// climate: 날씨 조회 실패 시 사용할 기후대 (temperate | mild | tropical | southern | cold)

const DESTINATIONS = [
  // 국내
  { id: 'jeju', name: '제주', country: '대한민국', group: '국내', lat: 33.50, lon: 126.53, plug: 'ok', voltage: 220, flight: 1, domestic: true, climate: 'temperate' },
  { id: 'busan', name: '부산', country: '대한민국', group: '국내', lat: 35.18, lon: 129.08, plug: 'ok', voltage: 220, flight: 0, domestic: true, climate: 'mild' },
  { id: 'gangneung', name: '강릉·속초', country: '대한민국', group: '국내', lat: 37.75, lon: 128.88, plug: 'ok', voltage: 220, flight: 0, domestic: true, climate: 'temperate' },
  { id: 'gyeongju', name: '경주', country: '대한민국', group: '국내', lat: 35.86, lon: 129.22, plug: 'ok', voltage: 220, flight: 0, domestic: true, climate: 'temperate' },

  // 일본
  { id: 'tokyo', name: '도쿄', country: '일본', group: '일본', lat: 35.68, lon: 139.69, plug: 'no', voltage: 100, flight: 2.5, climate: 'mild' },
  { id: 'osaka', name: '오사카·교토', country: '일본', group: '일본', lat: 34.69, lon: 135.50, plug: 'no', voltage: 100, flight: 2, climate: 'mild' },
  { id: 'fukuoka', name: '후쿠오카', country: '일본', group: '일본', lat: 33.59, lon: 130.40, plug: 'no', voltage: 100, flight: 1.5, climate: 'mild' },
  { id: 'sapporo', name: '삿포로', country: '일본', group: '일본', lat: 43.06, lon: 141.35, plug: 'no', voltage: 100, flight: 3, climate: 'cold' },
  { id: 'okinawa', name: '오키나와', country: '일본', group: '일본', lat: 26.21, lon: 127.68, plug: 'no', voltage: 100, flight: 2.5, climate: 'tropical' },

  // 중화권
  { id: 'taipei', name: '타이베이', country: '대만', group: '중화권', lat: 25.03, lon: 121.56, plug: 'no', voltage: 110, flight: 2.5, climate: 'tropical' },
  { id: 'hongkong', name: '홍콩·마카오', country: '홍콩', group: '중화권', lat: 22.32, lon: 114.17, plug: 'no', voltage: 220, flight: 3.5, climate: 'tropical' },
  { id: 'shanghai', name: '상하이', country: '중국', group: '중화권', lat: 31.23, lon: 121.47, plug: 'mixed', voltage: 220, flight: 2, climate: 'mild' },

  // 동남아
  { id: 'danang', name: '다낭', country: '베트남', group: '동남아', lat: 16.05, lon: 108.20, plug: 'mixed', voltage: 220, flight: 4.5, climate: 'tropical' },
  { id: 'nhatrang', name: '나트랑', country: '베트남', group: '동남아', lat: 12.24, lon: 109.19, plug: 'mixed', voltage: 220, flight: 5, climate: 'tropical' },
  { id: 'bangkok', name: '방콕', country: '태국', group: '동남아', lat: 13.75, lon: 100.50, plug: 'mixed', voltage: 220, flight: 6, climate: 'tropical' },
  { id: 'phuket', name: '푸껫', country: '태국', group: '동남아', lat: 7.88, lon: 98.39, plug: 'mixed', voltage: 220, flight: 6.5, climate: 'tropical' },
  { id: 'cebu', name: '세부', country: '필리핀', group: '동남아', lat: 10.31, lon: 123.89, plug: 'no', voltage: 220, flight: 4.5, climate: 'tropical' },
  { id: 'singapore', name: '싱가포르', country: '싱가포르', group: '동남아', lat: 1.35, lon: 103.82, plug: 'no', voltage: 230, flight: 6.5, climate: 'tropical' },
  { id: 'bali', name: '발리', country: '인도네시아', group: '동남아', lat: -8.34, lon: 115.09, plug: 'ok', voltage: 230, flight: 7, climate: 'tropical' },

  // 미주·대양주
  { id: 'guam', name: '괌', country: '미국령 괌', group: '미주·대양주', lat: 13.44, lon: 144.79, plug: 'no', voltage: 110, flight: 4.5, climate: 'tropical' },
  { id: 'saipan', name: '사이판', country: '미국령 사이판', group: '미주·대양주', lat: 15.18, lon: 145.75, plug: 'no', voltage: 110, flight: 4.5, climate: 'tropical' },
  { id: 'hawaii', name: '하와이', country: '미국', group: '미주·대양주', lat: 21.31, lon: -157.86, plug: 'no', voltage: 120, flight: 8.5, climate: 'tropical' },
  { id: 'la', name: 'LA', country: '미국', group: '미주·대양주', lat: 34.05, lon: -118.24, plug: 'no', voltage: 120, flight: 11, climate: 'mild' },
  { id: 'newyork', name: '뉴욕', country: '미국', group: '미주·대양주', lat: 40.71, lon: -74.01, plug: 'no', voltage: 120, flight: 14, climate: 'temperate' },
  { id: 'sydney', name: '시드니', country: '호주', group: '미주·대양주', lat: -33.87, lon: 151.21, plug: 'no', voltage: 230, flight: 10.5, climate: 'southern' },

  // 유럽
  { id: 'paris', name: '파리', country: '프랑스', group: '유럽', lat: 48.86, lon: 2.35, plug: 'ok', voltage: 230, flight: 14, europe: true, climate: 'temperate' },
  { id: 'rome', name: '로마', country: '이탈리아', group: '유럽', lat: 41.90, lon: 12.50, plug: 'ok', voltage: 230, flight: 13.5, europe: true, climate: 'mild' },
  { id: 'barcelona', name: '바르셀로나', country: '스페인', group: '유럽', lat: 41.39, lon: 2.17, plug: 'ok', voltage: 230, flight: 14, europe: true, climate: 'mild' },
  { id: 'london', name: '런던', country: '영국', group: '유럽', lat: 51.51, lon: -0.13, plug: 'no', voltage: 230, flight: 14, europe: true, climate: 'temperate' },
  { id: 'swiss', name: '스위스', country: '스위스', group: '유럽', lat: 46.80, lon: 8.23, plug: 'mixed', voltage: 230, flight: 13.5, europe: true, climate: 'cold' },
];

const PLUG_TEXT = {
  ok: '한국 플러그 그대로 사용 가능',
  no: '어댑터 필요',
  mixed: '숙소마다 콘센트가 달라 어댑터 권장',
};
